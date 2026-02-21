// XSWD Helper Functions (Optional simplified wrapper)
// You can also use the raw WebSocket approach in app.js

class XSWDClient {
    constructor(appData) {
        this.appData = appData;
        this.socket = null;
        this.isConnected = false;
        this.callbacks = {
            onConnect: null,
            onDisconnect: null,
            onResult: null,
            onError: null
        };
    }
    
    connect() {
        return new Promise((resolve, reject) => {
            this.socket = new WebSocket("ws://localhost:44326/xswd");
            
            this.socket.onopen = () => {
                this.socket.send(JSON.stringify(this.appData));
            };
            
            this.socket.onmessage = (event) => {
                const response = JSON.parse(event.data);
                
                if (response.accepted) {
                    this.isConnected = true;
                    if (this.callbacks.onConnect) this.callbacks.onConnect();
                    resolve();
                }
                
                if (response.result) {
                    if (this.callbacks.onResult) this.callbacks.onResult(response.result);
                }
                
                if (response.error) {
                    if (this.callbacks.onError) this.callbacks.onError(response.error);
                    reject(response.error);
                }
            };
            
            this.socket.onerror = (error) => {
                if (this.callbacks.onError) this.callbacks.onError(error);
                reject(error);
            };
            
            this.socket.onclose = () => {
                this.isConnected = false;
                if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
            };
        });
    }
    
    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
            this.isConnected = false;
        }
    }
    
    send(method, params = null) {
        if (!this.isConnected) {
            throw new Error("Not connected to wallet");
        }
        
        const request = {
            jsonrpc: "2.0",
            id: Date.now().toString(),
            method: method
        };
        
        if (params) request.params = params;
        
        this.socket.send(JSON.stringify(request));
    }
    
    on(event, callback) {
        this.callbacks[event] = callback;
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = XSWDClient;
} else {
    window.XSWDClient = XSWDClient;
}
