import {
    Service,
    Thread,
    TransformerItem,
    DataInterface,
    StreamReaderInterface,
} from "universeai";

import {
    Controller,
    ControllerParams,
} from "./Controller";

export type Message = {
    publicKey: string,
    creationTimestamp: Date,
    text: string | undefined,
    nodeId1: Buffer,
    hasBlob: boolean,
    blobLength: bigint | undefined,
    isDownloaded: boolean,
    imgSrc: any,
    attSrc: any,
    streamReader?: StreamReaderInterface,
};

export type ChannelState = {
    controller: ChannelController,
    messages: Array<Message>,
};

export type ChannelControllerParams = ControllerParams & {
    /** The channel node. */
    node: DataInterface,
};

const MIME_TYPES = {
    "png":  "image/png",
    "gif":  "image/gif",
    "jpg":  "image/jpeg",
    "jpeg": "image/jpeg",
    "bmp":  "image/bmp",
    "svg":  "image/svg+xml",
    "tif":  "image/tiff",
    "tiff": "image/tiff",
    "webp": "image/webp",
};

export class ChannelController extends Controller {
    /** License targets. */
    protected targets: Buffer[] = [];

    constructor(
        protected state: ChannelState,
        params: ChannelControllerParams) {

        params.threadName       = params.threadName ?? "channel";
        params.threadDefaults   = params.threadDefaults ?? {};
        params.threadDefaults.parentId = params.node.getId();

        super(params);

        if (params.node.getRefId()?.length) {
            // This is a private channel
            this.targets.push(params.node.getOwner()!);
            if (!params.node.getOwner()?.equals(params.node.getRefId()!)) {
                this.targets.push(params.node.getRefId()!);
            }
        }

        this.state.controller = this;
        this.state.messages = [];
    }

    public close() {
        super.close();

        this.state.messages = [];
    }

    protected handleOnChange(item: TransformerItem, eventType: string) {
        if (eventType === "add" || eventType === "insert") {
            const dataNode      = item.node as DataInterface;
            const text          = dataNode.getData()?.toString();
            const nodeId1       = dataNode.getId1() as Buffer;
            const hasBlob       = dataNode.hasBlob();
            const blobLength    = dataNode.getBlobLength();

            const timestamp = new Date(dataNode.getCreationTime()!);

            const autoDownload = true;

            const message: Message = {
                publicKey: dataNode.getOwner()!.toString("hex"),
                creationTimestamp: timestamp,
                text,
                nodeId1,
                hasBlob,
                blobLength,
                isDownloaded: false,
                imgSrc: undefined,
                attSrc: undefined,
            };

            if (eventType === "add") {
                this.state.messages.push(message);
            }
            else {
                this.state.messages.push(message);
                /*this.state.chatAreaMessages.splice(index, 1, message);*/
            }

            if (hasBlob && autoDownload) {
                // This is set to that we can follow the progress of the download in the UI.
                message.streamReader = this.downloadFull(dataNode, message);
            }

            this.update();
        }
        else if (eventType === "delete") {
            // TODO
        }
    }

    protected downloadFull(dataNode: DataInterface, message: Message) {
        const {blobDataPromise, streamReader} = this.thread.downloadFull(dataNode);

        blobDataPromise.then(blobData => {
            const nodeData = dataNode.getData();
            let filename = "";

            if(nodeData) {
                filename = nodeData.toString();
            }

            const extension = filename.toLowerCase().split(".").pop() ?? "";

            const mimeType = MIME_TYPES[extension as keyof typeof MIME_TYPES ] ?? "application/octet-stream";

            const file = new File(blobData, filename, { type: mimeType });

            const url = URL.createObjectURL(file);

            if (mimeType.startsWith("image/")) {
                message.imgSrc = url;
            }
            else {
                message.attSrc = url;
            }

            this.update();
        });

        return streamReader;
    }

    public async submitMessage(message: string, file: any) {
        if (file) {
            const filename = file.name;

            const blobHash = await this.Globals?.BrowserUtil.HashFileBrowser(file);

            const blobLength = BigInt(file.size);

            const [node] = await this.thread.post({
                    blobHash,
                    blobLength,
                    data: Buffer.from(filename),
                    contentType: "app/chat/attachment",
                });

            if (!node) {
                throw new Error("Could not create message node");
            }

            if (node.isLicensed()) {
                await this.thread.postLicense(node, {
                    targets: this.targets,
                });
            }

            const streamReader = new this.Globals!.BrowserFileStreamReader(file);

            this.thread.upload(node.getId1()!, streamReader);

            // TODO: show progress and detect errors on upload.
        }
        else {
            const params = {data: Buffer.from(message)};

            const [node] = await this.thread.post(params);

            if (!node) {
                throw new Error("Could not create message node");
            }

            if (node.isLicensed()) {
                await this.thread.postLicense(node, {
                    targets: this.targets,
                });
            }
        }
    }
}
