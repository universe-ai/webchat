export type Notification = {
    title: string,
};

export class NotificationsController {
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};

    protected state: {
        isBlurred: boolean,
    };

    constructor(protected title: string) {
        this.state = {
            isBlurred: false,
        };
    }

    public blurDetected() {
        this.state.isBlurred = true;
    }

    public focusDetected() {
        if (this.state.isBlurred) {
            this.state.isBlurred = false;
            this.notify({title: this.title});
        }
    }

    /**
     * Parse global message to see if it is interesting for the PresenceController.
     */
    public handleMessage(message: any) {
        try {
            if (message?.action === "NEW_MESSAGE") {
                if (this.state.isBlurred) {
                    this.notify({title: `⚡ ${this.title}`});
                }
            }
        }
        catch(e) {}
    }

    public onNotification(cb: (notification: Notification) => void): NotificationsController {
        this.hookEvent("notification", cb);
        return this;
    }

    protected notify(notification: Notification) {
        this.triggerEvent("notification", notification);
    }

    protected hookEvent(name: string, callback: ( (...args: any) => void)) {
        const cbs = this.handlers[name] || [];
        this.handlers[name] = cbs;
        cbs.push(callback);
    }

    protected unhookEvent(name: string, callback: ( (...args: any) => void)) {
        const cbs = (this.handlers[name] || []).filter( (cb: ( (...args: any) => void)) => callback !== cb );
        this.handlers[name] = cbs;
    }

    protected triggerEvent(name: string, ...args: any) {
        const cbs = this.handlers[name] || [];
        cbs.forEach( (callback: ( (...args: any) => void)) => {
            setImmediate( () => callback(...args) );
        });
    }
}
