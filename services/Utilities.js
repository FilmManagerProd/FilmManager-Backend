const { v4: uuidv4 } = require('uuid');

class Utilities {
    static generateUniqueID() {
        return uuidv4();
    }
}

module.exports = Utilities;