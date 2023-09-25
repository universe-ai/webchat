import {
    Service,
    Thread,
    TransformerItem,
    DataInterface,
} from "universeai";

import {
    Controller,
    ControllerParams,
} from "./Controller";

export type Channel = {
    node: DataInterface,
    isDirect: boolean,
    name: string,
    active: boolean,
};

export type ChannelsState = {
    controller: ChannelsController,
    list: Array<Channel>,
};

export class ChannelsController extends Controller {
    protected intervalHandle?: ReturnType<typeof setInterval>;

    constructor(
        protected state: ChannelsState,
        params: ControllerParams) {

        params.threadName = params.threadName ?? "channels";

        super(params);

        this.state.controller = this;
        this.state.list = [];
    }

    public close() {
        super.close();

        this.state.list = [];
    }

    protected handleOnChange(item: TransformerItem, eventType: string) {
        const publicKey = this.service.getPublicKey();

        if (eventType === "add" || eventType === "insert") {
            const isDirect = (item.node.getRefId()?.length ?? 0) > 0;

            const node = item.node as DataInterface;

            let name = node.getData()?.toString() ?? "<no name>";

            if (isDirect) {
                if (node.getRefId()?.equals(publicKey)) {
                    name = node.getOwner()!.toString("hex");
                }
                else {
                    name = node.getRefId()!.toString("hex");
                }
            }

            this.state.list.push({
                node,
                isDirect,
                name,
                active: false,
            });

            this.update();
        }
        else if (eventType === "delete") {
            // TODO
        }
    }

    /**
     * Make a private channel node between two peers, unless one already exists then return it.
     * @returns nodeId1 of the channel
     * @throws if channel node cannot be created.
     */
    public async makePrivateChannel(friendPublicKey: Buffer): Promise<Buffer> {
        // See if there already is a private chat for us and the user.
        //

        const ourPublicKey = this.service.getPublicKey();

        const length = this.state.list.length;
        for (let i=0; i<length; i++) {
            const channel = this.state.list[i];

            if (channel.node.getRefId()?.length) {
                if (channel.node.getOwner()?.equals(ourPublicKey)) {
                    if (channel.node.getRefId()?.equals(friendPublicKey)) {
                        // Channel exists.
                        return channel.node.getId1() as Buffer
                    }
                }
                else if (channel.node.getOwner()?.equals(friendPublicKey)) {
                    if (channel.node.getRefId()?.equals(ourPublicKey)) {
                        // Channel exists.
                        return channel.node.getId1() as Buffer;
                    }
                }
            }
        }

        // Chat does not exist.
        const [node] = await this.thread.post({
            refId: friendPublicKey,
        });

        if (!node) {
            throw new Error("Could not create channel node");
        }

        if (node.isLicensed()) {
            await this.thread.postLicense(node, {
                targets: [friendPublicKey, ourPublicKey],
            });
        }

        return node.getId1() as Buffer;
    }
}
