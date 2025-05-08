require("dotenv").config();

const admin = require("firebase-admin");

const serviceAccount = require("../serviceAccountKey.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
});

class DatabaseManager {
    constructor() {
        this.data = {};
        
        admin.database().ref().on('value', (snapshot) => {
            this.data = snapshot.val() || {};
            console.log(`\n[INTERNAL DATABASEMANAGER] - LIVE TAIL: Database re-synchronised.\n`);
        });
        
        return this._createProxy([]);
    }

    async load() {
        try {
            const snapshot = await admin.database().ref().once("value");
            this.data = snapshot.val() || {};
            return this.data;
        } catch (error) {
            throw new Error(`\n[INTERNAL DATABASEMANAGER] - FAILED: Error loading data from Firebase: ${error}.\n`);
        }
    }

    async save() {
        try {
            await admin.database().ref().update(this.data);
            return true;
        } catch (error) {
            throw new Error(`\n[INTERNAL DATABASEMANAGER] - FAILED: Error saving data to Firebase: ${error}.\n`);
        }
    }

    peek(pathArr) {
        const value = this._getValueByPath(pathArr);
        return value === undefined ? null : value;
    }

    destroy(pathArr) {
        if (!Array.isArray(pathArr) || pathArr.length === 0) {
            throw new Error(`\n[INTERNAL DATABASEMANAGER] - FAILED: "DM.destroy() method requires a non-empty array path.".\n`);
        }

        try {
            let ref = this.data;

            for (let i = 0; i < pathArr.length - 1; i++) {
                if (typeof ref[pathArr[i]] !== "object" || ref[pathArr[i]] === null) {
                    throw new Error(`\n[INTERNAL DATABASEMANAGER] - FAILED: Path ${pathArr.slice(0, i + 1).join(".")} does not exist.\n`);
                }
                ref = ref[pathArr[i]];
            }

            const keyToDelete = pathArr[pathArr.length - 1];

            if (ref && Object.prototype.hasOwnProperty.call(ref, keyToDelete)) {
                delete ref[keyToDelete];
            } else {
                throw new Error(`\n[INTERNAL DATABASEMANAGER] - FAILED: Key ${keyToDelete} not found at the specified path.\n`);
            }
        } catch (error) {
            throw new Error(`\n[INTERNAL DATABASEMANAGER] - FAILED: Error deleting data at path ${pathArr.join(".")}: ${error}.\n`);
        }
    }

    /**
     * Internal method to create a recursive proxy.
     * The proxy intercepts get/set operations so that you can use syntax like:
     * DM["Barcodes"]["someID"] = "value";
     *
     * @param {Array} path - The current path in the data tree.
     */
    _createProxy(path) {
        const self = this;

        const handler = {
            get(target, prop) {
                if (typeof prop === "symbol") {
                    return target[prop];
                }
            
                if (prop === "peek") {
                    return (pathArr) => self.peek(pathArr);
                }
            
                if (["save", "load", "destroy"].includes(prop)) {
                    return self[prop].bind(self);
                }
            
                if (prop === "toJSON") {
                    return () => self._getValueByPath(path);
                }
            
                const fullPath = path.concat(prop);
                let value = self._getValueByPath(fullPath);
            
                if (value === undefined) {
                    value = {};
                    self._setByPath(fullPath, value);
                }
            
                if (typeof value === "object" && value !== null) {
                    return self._createProxy(fullPath);
                }
                return value;
            }, set(target, prop, newValue) {
                const fullPath = path.concat(prop);

                try {
                    self._setByPath(fullPath, newValue);
                    return true;
                } catch (error) {
                    throw new Error(`\n[INTERNAL DATABASEMANAGER] - FAILED: Error setting value at ${fullPath.join(".")}: ${error}.\n`);
                }
            }, ownKeys(target) {
                const curData = self._getValueByPath(path);
                return curData ? Reflect.ownKeys(curData) : [];
            }, getOwnPropertyDescriptor(target, key) {
                return {
                    configurable: true,
                    enumerable: true,
                };
            }
        };

        return new Proxy({}, handler);
    }

    /**
     * Helper to get a value in the internal data object at the specified path.
     *
     * @param {Array} path - Array representing the nested keys.
     */
    _getValueByPath(path) {
        return path.reduce(
            (acc, key) => (acc ? acc[key] : undefined),
            this.data
        );
    }

    /**
     * Helper to set a value in the internal data object at the specified path.
     *
     * @param {Array} path - Array representing the nested keys.
     * @param {*} value - Value to be set.
     */
    _setByPath(path, value) {
        if (!Array.isArray(path) || path.length === 0) {
            throw new Error(`\n[INTERNAL DATABASEMANAGER] - FAILED: Invalid path for setting value.\n`);
        }

        let ref = this.data;

        for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            if (typeof ref[key] !== "object" || ref[key] === null) {
                ref[key] = {};
            }
            ref = ref[key];
        }

        ref[path[path.length - 1]] = value;
    }
}

module.exports = new DatabaseManager();