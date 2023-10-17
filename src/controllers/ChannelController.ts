import {
    DataInterface,
    StreamWriterInterface,
    TRANSFORMER_EVENT,
    BufferStreamWriter,
    StreamStatus,
    WriteStats,
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
    imgSrc: any,
    attSrc: any,
    downloadStreamWriter?: StreamWriterInterface,
    uploadStreamWriter?: StreamWriterInterface,
    downloadInfo?: {linkText?: string, error?: string, throughput?: string},
    uploadInfo?: {text?: string, error?: string, throughput?: string, downloadLink?: string, uploadLink?: string, file?: File},
    objectURL?: any,
};

export type ChannelControllerParams = ControllerParams & {
    /** The channel node. */
    node: DataInterface,
};

const MAX_BLOB_SIZE = 100 * 1024 * 1024;

// These are mime types we show in the client,
// other mime types will be attachemnts.
const MIME_TYPES = {
    "apng":  "image/apng",
    "avif":  "image/avif",
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

    // this will be inited from the original fetch request.
    protected tail: number;

    constructor(protected params: ChannelControllerParams) {

        params.threadName       = params.threadName ?? "channel";
        params.threadDefaults   = params.threadDefaults ?? {};
        params.threadDefaults.parentId = params.node.getId();

        super(params);

        // init tail from original fetch request.
        const fetchRequest = this.thread.getFetchRequest(params.threadFetchParams);

        this.tail = fetchRequest.transform.tail;

        if (params.node.getRefId()?.length) {
            // This is a private channel
            this.targets.push(params.node.getOwner()!);

            if (!params.node.getOwner()?.equals(params.node.getRefId()!)) {
                this.targets.push(params.node.getRefId()!);
            }
        }
    }

    public static GetName(node: DataInterface, publicKey: Buffer): {name: string, isDirect: boolean} {
        const isDirect = (node.getRefId()?.length ?? 0) > 0;

        let name = node.getData()?.toString() ?? "<no name>";

        if (isDirect) {
            if (node.getRefId()?.equals(publicKey)) {
                name = node.getOwner()!.toString("hex");
            }
            else {
                name = node.getRefId()!.toString("hex");
            }
        }

        return {name, isDirect};
    }

    public getName(): {name: string, isDirect: boolean} {
        const publicKey = this.service.getPublicKey();

        return ChannelController.GetName(this.params.node, publicKey);
    }

    public close() {
        super.close();
    }

    protected handleOnChange(event: TRANSFORMER_EVENT) {
        event.added.forEach( id1 => {
            const node = this.threadStreamResponseAPI.getTransformer().getNode(id1);
            const message = this.threadStreamResponseAPI.getTransformer().getData(id1) as Message;

            if (!node || !message) {
                return;
            }

            const text          = node.getData()?.toString();
            const hasBlob       = node.hasBlob();
            const blobLength    = node.getBlobLength();

            const timestamp = new Date(node.getCreationTime()!);

            message.publicKey = node.getOwner()!.toString("hex");
            message.id1 = id1.toString("hex");
            message.creationTimestamp = timestamp;
            message.text = text;
            message.hasBlob = hasBlob;
            message.blobLength = blobLength;

            if (hasBlob && blobLength !== undefined && !message.imgSrc &&
                !message.uploadInfo && !message.uploadStreamWriter) {

                const extension = node.getData()?.toString().toLowerCase().split(".").pop() ?? "";
                const mimeType = MIME_TYPES[extension as keyof typeof MIME_TYPES ] ?? "";

                if (blobLength > BigInt(MAX_BLOB_SIZE)) {
                    message.downloadInfo = {error: `Attachment ${text} too large to download in browser client (${blobLength} bytes).`};
                }
                else if (mimeType.startsWith("image/")) {
                    this.download(node, message);
                }
                else {
                    message.downloadInfo = {linkText: `Click to download ${text} (${blobLength} bytes).`};
                }
            }
        });

        event.deleted.forEach( id1 => {
            const message = this.threadStreamResponseAPI.getTransformer().getData(id1) as Message;

            if (!message) {
                return;
            }

            if (message.objectURL) {
                // NOTE: we could leave the ObjectURL here when we add the GC to purge
                // data objects not in the model anymore.
                URL.revokeObjectURL(message.objectURL);
                delete message.objectURL;
                delete message.imgSrc;
                delete message.attSrc;
            }
        });

        this.update();

        if (event.added.length > 0) {
            this.notify();
        }
    }

    protected download(node: DataInterface, message: Message, retry: boolean = true) {
        const streamReader = this.thread.getBlobStreamReader(node.getId1()!);
        let downloadStreamWriter: StreamWriterInterface | undefined;

        const filename = node.getData()?.toString() ?? "";

        const extension = filename.toLowerCase().split(".").pop() ?? "";

        const mimeType = MIME_TYPES[extension as keyof typeof MIME_TYPES ] ?? "";

        const showBlob = mimeType.startsWith("image/") && node.getBlobLength()! <= BigInt(MAX_BLOB_SIZE);

        // download image to show in UI.
        downloadStreamWriter = new BufferStreamWriter(streamReader);

        message.downloadStreamWriter = downloadStreamWriter;

        downloadStreamWriter.run(0).then( writeData => {
            if (writeData.status === StreamStatus.RESULT) {
                const file = new File((downloadStreamWriter as BufferStreamWriter).getBuffers(), filename, { type: mimeType });

                message.objectURL = URL.createObjectURL(file);

                if (showBlob) {
                    message.imgSrc = message.objectURL;
                }
                else {
                    message.attSrc = message.objectURL;
                }

                delete message.downloadInfo;
            }
            else {
                if (!retry) {

                    message.downloadInfo = {error: `${message.text} could not be downloaded.`, linkText: "Click to try again."};

                    this.update();

                    return;
                }

                // hook service
                const unhook = this.params.service.onBlob(node.getId1()!, () => {
                    this.download(node, message, false);
                });

                (async () => {
                    const generator = this.params.service.syncBlob(node.getId1()!);

                    while (true) {
                        const value = generator.next().value;

                        if (value === undefined) {
                            message.downloadInfo = {error: `${message.text} could not be fetched from peers.`, linkText: "Click to try again."};
                            break;
                        }

                        value.streamWriter.onStats( stats => {
                            const throughput = this.formatThroughput(stats).throughput;

                            message.downloadInfo = {
                                error: `Found ${message.text} with peer. Fetching it.`,
                                throughput,
                            };

                            this.update();
                        });

                        const success = await value.promise;

                        if (!success) {
                            continue;
                        }

                        // Success. Hook will be called now.
                        return;
                    }

                    // No success
                    unhook();

                    this.update();
                })();

                message.downloadInfo = {error: `Could not download ${message.text}. Attempting to fetch it from peers, hang on...`};
            }

            this.update();
        });

        downloadStreamWriter?.onStats( stats => {
            message.downloadInfo = this.formatThroughput(stats);
            this.update();
        });

        this.update();
    }

    protected formatThroughput(stats: WriteStats): {throughput: string} {
        if (stats.finishTime) {
            return {throughput: "Finished"};
        }

        const throughput = stats.isPaused ? "Paused" :
            `${Math.floor(stats.throughput / 1024)} kb/s`;

        const percent = Number( (Number(stats.pos) / Number(stats.size) || 0) * 100).toFixed(2);

        return {throughput: `${percent}% ${throughput}`};
    }

    public async reupload(node: DataInterface, message: Message) {

        const file = message.uploadInfo?.file;

        if (!file) {
            return;
        }

        if (!node.hasBlob()) {
            throw new Error("node does not have blob");
        }

        if (node.getData()?.toString() !== file.name) {
            alert("Mismatch in file name. When reuploading the file chosen must be the same as original");

            return;
        }

        if (node.getBlobLength()! !== BigInt(file.size)) {
            alert("Mismatch in file size. When reuploading the file chosen must be the same as original");

            return;
        }

        this.update({hashing: true});

        const blobHash = await this.Globals?.BrowserUtil.HashFileBrowser(file);

        this.update({hashing: false});

        if (!blobHash) {
            return;
        }

        if (!node.getBlobHash()?.equals(blobHash)) {
            alert("Mismatch in hash. When reuploading the file chosen must be the same as original");

            return;
        }

        if (file.size > MAX_BLOB_SIZE) {
            alert(`Error: File uploads can be maximum ${MAX_BLOB_SIZE} bytes`);
            return;
        }

        const uploadStreamWriter = this.createUploadStreamer(file, message, node);

        message.uploadStreamWriter = uploadStreamWriter;

        this.update();
    }

    public loadHistory() {
        this.tail += 10;
        this.updateStream({tail: this.tail});
    }

    protected createUploadStreamer(file: File, message: Message, node: DataInterface): StreamWriterInterface {
        const streamReader = new this.Globals!.BrowserFileStreamReader(file);

        const uploadStreamWriter = this.thread.getBlobStreamWriter(node.getId1()!, streamReader);

        uploadStreamWriter.run().then( writeData => {
            if (writeData.status === StreamStatus.RESULT) {
                const filename = node.getData()?.toString() ?? "";

                const extension = filename.toLowerCase().split(".").pop() ?? "";

                const mimeType = MIME_TYPES[extension as keyof typeof MIME_TYPES ] ?? "";

                if (mimeType.startsWith("image/")) {
                    message.objectURL = URL.createObjectURL(file);
                    message.imgSrc = message.objectURL;

                    delete message.uploadInfo;
                }
                else {
                    message.uploadInfo = {text: `File ${file.name} uploaded successfully.`, downloadLink: "Click to download."};
                }
            }
            else {
                message.uploadInfo = {text: writeData.error, file, uploadLink: "Click to reupload"};
            }

            delete message.uploadStreamWriter;

            this.update();
        });

        uploadStreamWriter.onStats( stats => {
            message.uploadInfo = this.formatThroughput(stats);
            this.update();
        });

        return uploadStreamWriter;
    }

    public async submitMessage(messageText: string, file: File) {
        let refId: Buffer | undefined;

        const lastItem = this.threadStreamResponseAPI.getTransformer().getLastItem();

        refId = lastItem?.node.getId1();

        if (file) {
            if (file.size > MAX_BLOB_SIZE) {
                alert(`Error: File uploads can be maximum ${MAX_BLOB_SIZE} bytes`);
                return;
            }

            const filename = file.name;

            this.update({hashing: true});
            const blobHash = await this.Globals?.BrowserUtil.HashFileBrowser(file);
            this.update({hashing: false});

            const blobLength = BigInt(file.size);

            const [node] = await this.thread.post("attachment", {
                    refId,
                    blobHash,
                    blobLength,
                    data: Buffer.from(filename),
                    contentType: "app/chat/attachment",
                });

            if (!node) {
                throw new Error("Could not create message node");
            }

            if (node.isLicensed()) {
                await this.thread.postLicense("default", node, {
                    targets: this.targets,
                });
            }

            // Pre-create the message with many missing properties, but that is fine.
            const message: any = {};

            this.threadStreamResponseAPI.getTransformer().setData(node.getId1()!, message);

            const uploadStreamWriter = this.createUploadStreamer(file, message, node);

            message.uploadStreamWriter = uploadStreamWriter;
        }
        else {
            const params = {
                refId,
                data: Buffer.from(messageText),
            };

            const [node] = await this.thread.post("message", params);

            if (!node) {
                throw new Error("Could not create message node");
            }

            if (node.isLicensed()) {
                await this.thread.postLicense("default", node, {
                    targets: this.targets,
                });
            }
        }
    }
}
