import {
    DataInterface,
    StreamWriterInterface,
    CRDTVIEW_EVENT,
    BufferStreamWriter,
    StreamStatus,
    WriteStats,
    CRDTMessagesAnnotations,
    BrowserUtil,
    BrowserFileStreamReader,
    ThreadController,
    ThreadControllerParams,
} from "universeai";

export type Message = {
    publicKey: string,
    id1: string,
    creationTimestamp: Date,
    text: string | undefined,
    editedText: string | undefined,
    reactions?: {[key: string]: any};
    hasBlob: boolean,
    blobLength: bigint | undefined,
    imgSrc: any,
    attSrc: any,
    downloadStreamWriter?: StreamWriterInterface,
    uploadStreamWriter?: StreamWriterInterface,
    downloadCancelled?: boolean,  // set when cancel is clicked, to avoid a retry.
    downloadInfo?: {linkText?: string, error?: string, throughput?: string},
    uploadInfo?: {text?: string, error?: string, throughput?: string, downloadLink?: string, uploadLink?: string, file?: File},
    objectURL?: any,
};

export type ChannelControllerParams = ThreadControllerParams & {
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

export class ChannelController extends ThreadController {
    /** License targets. */
    protected targets: Buffer[] = [];

    // this will be inited from the original fetch request.
    protected tail: number;

    protected purgeInterval: ReturnType<typeof setInterval>;

    constructor(protected params: ChannelControllerParams) {

        params.threadName       = params.threadName ?? "channel";
        params.threadDefaults   = params.threadDefaults ?? {};
        params.threadDefaults.parentId = params.node.getId();

        super(params);

        // init tail from original fetch request.
        const fetchRequest = this.thread.getFetchRequest(params.threadFetchParams);

        this.tail = fetchRequest.crdt.tail;

        if (params.node.getRefId()?.length) {
            // This is a private channel
            this.targets.push(params.node.getOwner()!);

            if (!params.node.getOwner()?.equals(params.node.getRefId()!)) {
                this.targets.push(params.node.getRefId()!);
            }
        }

        // How often to purge old images who are not in view.
        // Every minute purge images older than 10 minutes.
        this.purgeInterval = setInterval( () => this.purge(600000), 60000);
    }

    /**
     * Call on intervals to purge resources not in the view, of a certain age as deleted.
     */
    protected purge(age: number = 0) {
        this.threadStreamResponseAPI.getCRDTView().purge(age).forEach( (message: Message) => {
            if (message.objectURL) {
                URL.revokeObjectURL(message.objectURL);
                delete message.objectURL;
                delete message.imgSrc;
                delete message.attSrc;
            }
        });
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
        clearInterval(this.purgeInterval);

        this.purge();

        super.close();
    }

    protected handleOnChange(event: CRDTVIEW_EVENT) {
        event.updated.forEach( id1 => {
            const node = this.threadStreamResponseAPI.getCRDTView().getNode(id1);

            const message = this.threadStreamResponseAPI.getCRDTView().getData(id1) as Message;

            if (!node || !message) {
                return;
            }

            const annotations = node.getAnnotations();

            if (annotations) {
                try {
                    const crdtMessageAnnotaions = new CRDTMessagesAnnotations();

                    crdtMessageAnnotaions.load(annotations);

                    const editNode = crdtMessageAnnotaions.getEditNode();

                    if (editNode) {
                        const editedText = editNode.getData()?.toString();

                        message.editedText = editedText;
                    }

                    const reactions = crdtMessageAnnotaions.getReactions();

                    message.reactions = reactions;
                }
                catch(e) {
                    // Fall through.
                }
            }
        });

        event.added.forEach( id1 => {
            const node = this.threadStreamResponseAPI.getCRDTView().getNode(id1);
            const message = this.threadStreamResponseAPI.getCRDTView().getData(id1) as Message;

            if (!node || !message) {
                return;
            }


            let editedText: string | undefined;
            let reactions: any;

            const annotations = node.getAnnotations();

            if (annotations) {
                try {
                    const crdtMessageAnnotaions = new CRDTMessagesAnnotations();

                    crdtMessageAnnotaions.load(annotations);

                    const editNode = crdtMessageAnnotaions.getEditNode();

                    if (editNode) {
                        const editedText = editNode.getData()?.toString();

                        message.editedText = editedText;
                    }

                    const reactions = crdtMessageAnnotaions.getReactions();

                    message.reactions = reactions;
                }
                catch(e) {
                    // Fall through.
                }
            }

            const text          = node.getData()?.toString();
            const hasBlob       = node.hasBlob();
            const blobLength    = node.getBlobLength();

            const timestamp = new Date(node.getCreationTime()!);

            message.publicKey = node.getOwner()!.toString("hex");
            message.id1 = id1.toString("hex");
            message.creationTimestamp = timestamp;
            message.text = text;
            message.editedText = editedText;
            message.reactions = reactions;
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
            const message = this.threadStreamResponseAPI.getCRDTView().getData(id1) as Message;

            if (!message) {
                return;
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
            delete message.downloadStreamWriter;

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
                if (!retry || message.downloadCancelled) {

                    delete message.downloadCancelled;

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

                            if (stats.written === 0n) {
                                message.downloadInfo = {
                                    error: `Waiting to sync ${message.text} from peer.`,
                                };
                            }
                            else {
                                message.downloadInfo = {
                                    error: `Syncing ${message.text} from peer to storage.`,
                                    throughput,
                                };
                            }

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

        const blobHash = await BrowserUtil.HashFileBrowser(file);

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
        const streamReader = new BrowserFileStreamReader(file);

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
                    delete message.uploadInfo;
                    message.downloadInfo = {error: `File ${file.name} uploaded successfully.`, linkText: "Click to download."};
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

        const lastItem = this.threadStreamResponseAPI.getCRDTView().getLastItem();

        refId = lastItem?.node.getId1();

        if (file) {
            if (file.size > MAX_BLOB_SIZE) {
                alert(`Error: File uploads can be maximum ${MAX_BLOB_SIZE} bytes`);
                return;
            }

            const filename = file.name;

            this.update({hashing: true});
            const blobHash = await BrowserUtil.HashFileBrowser(file);
            this.update({hashing: false});

            const blobLength = BigInt(file.size);

            const [node] = await this.thread.post("attachment", {
                    refId,
                    blobHash,
                    blobLength,
                    data: Buffer.from(filename),
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

            this.threadStreamResponseAPI.getCRDTView().setData(node.getId1()!, message);

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

    public async editMessage(nodeToEdit: DataInterface, messageText: string) {
        const params = {
            data: Buffer.from(messageText),
        };

        const [node] = await this.thread.postEdit(nodeToEdit, "message", params);

        if (!node) {
            throw new Error("Could not create edit message node");
        }

        if (node.isLicensed()) {
            await this.thread.postLicense("default", node, {
                targets: this.targets,
            });
        }
    }

    public async toggleReaction(message: Message, nodeToReactTo: DataInterface, reaction: string, unreact = false) {

        const publicKey = this.service.getPublicKey().toString("hex");

        let onoff = "react";

        if (message.reactions?.reactions[reaction]?.publicKeys.includes(publicKey)) {
            onoff = "unreact";
        }

        const params = {
            data: Buffer.from(`${onoff}/${reaction}`),
        };

        const [node] = await this.thread.postReaction(nodeToReactTo, "message", params);

        if (!node) {
            throw new Error("Could not create reaction message node");
        }

        if (node.isLicensed()) {
            await this.thread.postLicense("default", node, {
                targets: this.targets,
            });
        }
    }

    public async deleteMessage(messageNode: DataInterface) {
        // First edit the node with an empty string which will effectively hide the node.
        // This is because actual deletion of nodes is not instant, but editing nodes is instant.
        //
        await this.editMessage(messageNode, "");

        // We delay the actual deletion some, just to give the above edit message annotation
        // a chance to spread before the node is removed. If the node is destroyed directly then
        // the above notification cannot get distributed.
        setTimeout( async () => {
            const destroyNodes = await this.thread.delete(messageNode);

            destroyNodes.forEach( async (node) => {
                if (node.isLicensed() && node.getLicenseMinDistance() === 0) {
                    const licenses = await this.thread.postLicense("default", node, {
                        targets: this.targets,
                    });
                }
            });
        }, 1000);
    }
}
