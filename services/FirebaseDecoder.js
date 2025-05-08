function FirebaseDecoder(errorMsg) {
    try {
        // Remove optional prefixes
        errorMsg = errorMsg.replace(/^(U?ERROR:\s*)/, "");

        // Try to extract the error code (like PASSWORD_DOES_NOT_MEET_REQUIREMENTS)
        const codeMatch = errorMsg.match(/"message":"([A-Z_]+)\s*:/);
        if (codeMatch && codeMatch[1]) {
            const cleaned = codeMatch[1]
                .toLowerCase()
                .replace(/_/g, " ");
            return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        }

        // Fallback: Extract from Firebase: Error (auth/...)
        const prefix = "Firebase: Error (";
        const suffix = ")";
        const startIndex = errorMsg.indexOf(prefix);
        const endIndex = errorMsg.lastIndexOf(suffix);

        if (startIndex !== -1 && endIndex > startIndex) {
            const extracted = errorMsg.substring(startIndex + prefix.length, endIndex);
            const withoutAuth = extracted.replace("auth/", "");
            const withSpaces = withoutAuth.replace(/-/g, " ");
            return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
        }

        return errorMsg;
    } catch {
        return errorMsg;
    }
}

module.exports = FirebaseDecoder;