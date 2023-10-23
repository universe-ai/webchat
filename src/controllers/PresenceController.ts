import {
    NodeInterface,
    TRANSFORMER_EVENT,
    Hash,
} from "universeai";

import {
    Controller,
    ControllerParams,
} from "./Controller";

export type PresenceState = {
    /** Last user activity detected (mouse move, etc). */
    lastActivityDetected: number,

    isActive: boolean,

    /** List of public keys of active users. */
    active: Buffer[],

    /** List of public keys of inactive users. */
    inactive: Buffer[],

    /** List of incoming presence nodes which are filtered into active or inactive lists. */
    presenceNodes: {[hash: string]: {
        /** Owner public key of the presence node (user). */
        publicKey: Buffer,

        /** Each node incoming which also updates the presence. */
        nodes: {[id1: string]: NodeInterface},

        /**
         * List of timestamp of when nodes came in, maximum two are kept.
         * The diff of the two timestamp is used to determince if the user is active.
         */
        pings: number[],
    }},
};

// Users show as inactive after this threshold.
const INACTIVE_THRESHOLD = 1 * 60 * 1000;

export class PresenceController extends Controller {
    protected pulseInterval?: ReturnType<typeof setInterval>;
    protected refreshInterval?: ReturnType<typeof setInterval>;
    protected state: PresenceState;
    protected instanceRandomId: Buffer;

    constructor(params: ControllerParams) {

        params.threadName = params.threadName ?? "presence";

        super(params);

        this.instanceRandomId = Buffer.alloc(4);
        self.crypto.getRandomValues(this.instanceRandomId);

        this.state = {
            lastActivityDetected: 0,
            isActive: false,
            active: [],
            inactive: [],
            presenceNodes: {},
        };

        this.init();
    }

    protected init() {
        this.refreshInterval = setInterval(() => this.refreshPresence(), INACTIVE_THRESHOLD / 4);
    }

    protected postPresence(force: boolean = false) {
        // Clear in case is called outside setTimeout.
        clearTimeout(this.pulseInterval);

        if (this.isActive() || force) {
            this.thread.post("presence", {data: this.instanceRandomId});
        }

        this.pulseInterval = setTimeout( () => {
            this.postPresence();
        }, INACTIVE_THRESHOLD);
    }

    public activityDetected() {
        this.state.lastActivityDetected = Date.now();

        if (!this.isActive()) {
            this.state.isActive = true;
            this.triggerEvent("active");
            this.postPresence(true);
        }
    }

    public isActive(): boolean {
        return this.state.isActive;
    }

    public onActive(cb: () => void): PresenceController {
        this.hookEvent("active", cb);
        return this;
    }

    public onInactive(cb: () => void): PresenceController {
        this.hookEvent("inactive", cb);
        return this;
    }

    public getActivePresence(): Buffer[] {
        return this.state.active;
    }

    public getInactivePresence(): Buffer[] {
        return this.state.inactive;
    }

    public close() {
        super.close();

        clearInterval(this.refreshInterval);
        clearInterval(this.pulseInterval);

        this.state.presenceNodes = {}
        this.state.active = [];
        this.state.inactive = [];
    }

    protected handleOnChange(event: TRANSFORMER_EVENT) {
        event.added.forEach( id1 => {
            const node = this.threadStreamResponseAPI.getTransformer().getNode(id1);

            const publicKey = node?.getOwner();

            if (!node || !publicKey) {
                return;
            }

            // We hash like this to let the same user run multiple apps simultanously.
            // The app will populate data with some random bytes.
            const hashStr = Hash([publicKey, node.getData()]).toString("hex");

            const presenceNode = this.state.presenceNodes[hashStr] ?? {
                publicKey,
                nodes: {},
                pings: [],
            };

            this.state.presenceNodes[hashStr] = presenceNode;

            presenceNode.nodes[node.getId1()!.toString("hex")] = node;

            presenceNode.pings.unshift(Date.now());
        });

        event.deleted.forEach( id1 => {
            const id1Str = id1.toString("hex");

            for (const hashStr in this.state.presenceNodes) {
                const presenceNode = this.state.presenceNodes[hashStr];

                if (presenceNode.nodes[id1Str]) {
                    delete presenceNode.nodes[id1Str];
                    break;
                }
            }
        });

        this.refreshPresence();
    }

    protected refreshPresence = () => {
        // Check if going inactive.
        if (this.isActive()) {
            if (Date.now() - this.state.lastActivityDetected >= INACTIVE_THRESHOLD) {
                this.state.isActive = false;
                this.triggerEvent("inactive");
            }
        }

        const active: {[id1: string]: Buffer} = {};
        const inactive: {[id1: string]: Buffer} = {};

        for (const hashStr in this.state.presenceNodes) {
            const presenceNode = this.state.presenceNodes[hashStr];

            if (Object.values(presenceNode.nodes).length === 0) {
                delete this.state.presenceNodes[hashStr];
                continue;
            }

            let isActive = false;

            if (presenceNode.pings.length === 1) {
                // In the case there is only a single ping we could count that as active for some time.
                isActive = Date.now() - presenceNode.pings[0] < INACTIVE_THRESHOLD * 1.5;
            }
            else if (presenceNode.pings.length >= 2) {
                const diff = presenceNode.pings[0] - presenceNode.pings[1];

                // A well spaced out activity pulse indicates a live user, where
                // a too tight spacing is just syncing old data, and too far out spacing is inactivity.
                isActive = diff >= INACTIVE_THRESHOLD * 0.5 && Date.now() - presenceNode.pings[0] < INACTIVE_THRESHOLD * 1.5;

                presenceNode.pings.length = 2;
            }

            if (isActive) {
                active[presenceNode.publicKey.toString("hex")] = presenceNode.publicKey;
                delete inactive[presenceNode.publicKey.toString("hex")];
            }
            else {
                if (!active[presenceNode.publicKey.toString("hex")]) {
                    inactive[presenceNode.publicKey.toString("hex")] = presenceNode.publicKey;
                }
            }
        }

        this.state.active   = Object.values(active);
        this.state.inactive = Object.values(inactive);

        this.update();
    }
}
