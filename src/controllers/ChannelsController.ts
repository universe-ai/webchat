import {
    DataInterface,
    CRDTVIEW_EVENT,
} from "universeai";

import {
    Controller,
    ControllerParams,
} from "./Controller";

import {
    ChannelController,
} from "./ChannelController";

export type Channel = {
    isDirect: boolean,
    name: string,
    active: boolean,
    open: boolean,
};

export class ChannelsController extends Controller {
    protected channelControllers: {[nodeId1: string]: ChannelController} = {};

    protected channelNotifications: {[id1: string]: boolean} = {};

    constructor(params: ControllerParams) {

        params.threadName = params.threadName ?? "channels";

        super(params);
    }

    public close() {
        super.close();
    }

    protected handleOnChange(event: CRDTVIEW_EVENT) {
        const publicKey = this.service.getPublicKey();

        event.added.forEach( id1 => {
            const node = this.threadStreamResponseAPI.getCRDTView().getNode(id1);
            const data = this.threadStreamResponseAPI.getCRDTView().getData(id1);

            if (!node || !data) {
                return;
            }

            const {name, isDirect} = ChannelController.GetName(node, publicKey);

            data.isDirect = isDirect;
            data.name     = name;
            data.active   = false;
            data.open     = false;
        });

        this.update();
    }

    public getChannelController(node: DataInterface): ChannelController {
        if (!this.params.Globals) {
            throw new Error("Missing Globals to be set");
        }

        const nodeId1 = node.getId1()!;

        const id1Str = nodeId1.toString("hex");

        const item = this.threadStreamResponseAPI.getCRDTView().findItem(nodeId1);

        let channelController = this.channelControllers[id1Str];

        if (!channelController) {
            channelController =
                new this.params.Globals.ChannelController({
                    Globals: this.params.Globals,
                    service: this.params.service,
                    node,
                });

            channelController.onNotification( () => {
                if (item?.data.active === false) {
                    this.channelNotifications[id1Str] = true;

                    this.update();
                }

            });

            this.channelControllers[id1Str] = channelController;
        }

        return channelController;
    }

    public setChannelActive(nodeId1: Buffer) {
        const items = this.threadStreamResponseAPI.getCRDTView().getItems();

        const id1Str = nodeId1.toString("hex");

        const itemsLength = items.length;

        for (let i=0; i<itemsLength; i++) {
            const item = items[i];

            if (item.id1.equals(nodeId1)) {
                item.data.active = true;
            }
            else {
                item.data.active = false;
            }

            // Reset notification.
            this.channelNotifications[id1Str] = false;
        }
    }

    public hasNotification(id1: Buffer): boolean {
        const id1Str = id1.toString("hex");

        return this.channelNotifications[id1Str] ?? false;
    }

    public openChannel(nodeId1: Buffer) {
        const item = this.threadStreamResponseAPI.getCRDTView().findItem(nodeId1);

        if (item) {
            item.data.open = true;
        }
    }

    /**
     * Make a private channel node between two peers, unless one already exists then return it.
     *
     * @returns nodeId1 of the channel
     * @throws if channel node cannot be created.
     */
    public async makePrivateChannel(friendPublicKey: Buffer): Promise<Buffer> {
        // See if there already is a private chat for us and the user.
        //

        const ourPublicKey = this.service.getPublicKey();

        const items = this.threadStreamResponseAPI.getCRDTView().getItems();

        const itemsLength = items.length;

        for (let i=0; i<itemsLength; i++) {
            const item = items[i];

            const node = item.node;

            if (node.getRefId()?.length) {
                if (node.getOwner()?.equals(ourPublicKey)) {
                    if (node.getRefId()?.equals(friendPublicKey)) {
                        // Channel exists.

                        return node.getId1() as Buffer
                    }
                }
                else if (node.getOwner()?.equals(friendPublicKey)) {
                    if (node.getRefId()?.equals(ourPublicKey)) {
                        // Channel exists.

                        return node.getId1() as Buffer;
                    }
                }
            }
        }

        // Chat does not exist.
        const [node] = await this.thread.post("channel", {
            refId: friendPublicKey,
        });

        if (!node) {
            throw new Error("Could not create channel node");
        }

        if (node.isLicensed()) {
            await this.thread.postLicense("channel", node, {
                targets: [friendPublicKey, ourPublicKey],
            });
        }

        return node.getId1() as Buffer;
    }
}
