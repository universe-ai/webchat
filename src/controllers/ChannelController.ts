import {
    DataInterface,
    StreamReaderInterface,
    TRANSFORMER_EVENT,
} from "universeai";

import {
    Controller,
    ControllerParams,
} from "./Controller";

export type Message = {
    publicKey: string,
    id1: string,
    creationTimestamp: Date,
    text: string | undefined,
    hasBlob: boolean,
    blobLength: bigint | undefined,
    isDownloaded: boolean,
    imgSrc: any,
    attSrc: any,
    streamReader?: StreamReaderInterface,
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

    constructor(params: ChannelControllerParams) {

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
    }

    public close() {
        super.close();
    }

    protected handleOnChange(event: TRANSFORMER_EVENT) {
        event.added.forEach( id1 => {
            const node = this.threadStreamResponseAPI.getTransformer().getNode(id1);
            const data = this.threadStreamResponseAPI.getTransformer().getData(id1) as Message;

            if (!node || !data) {
                return;
            }

            const text          = node.getData()?.toString();
            const hasBlob       = node.hasBlob();
            const blobLength    = node.getBlobLength();

            const timestamp = new Date(node.getCreationTime()!);

            const autoDownload = true;

            data.publicKey = node.getOwner()!.toString("hex");
            data.id1 = id1.toString("hex");
            data.creationTimestamp = timestamp;
            data.text = text;
            data.hasBlob = hasBlob;
            data.blobLength = blobLength;

                //isDownloaded: false,
                //imgSrc: undefined,
                //attSrc: undefined,



            //if (hasBlob && autoDownload) {
                //// This is set to that we can follow the progress of the download in the UI.
                //message.streamReader = this.downloadFull(dataNode, message);
            //}
        });

        this.update();
    }

    protected downloadFull(dataNode: DataInterface, data: Message) {
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
                data.imgSrc = url;
            }
            else {
                data.attSrc = url;
            }

            this.update();
        });

        return streamReader;
    }

    public async submitMessage(messageText: string, file: any) {
        if (file) {
            const filename = file.name;

            const blobHash = await this.Globals?.BrowserUtil.HashFileBrowser(file);

            const blobLength = BigInt(file.size);

            // TODO refId
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
            const params = {data: Buffer.from(messageText)};

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
