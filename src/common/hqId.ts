class HqId {
    private static generate(length: number, randomCase: boolean) {
        const CHARACTERS = 'qwertyuiopasdfghjklzxcvbnm1234567890';

        let id = '';
        for (let i = 0; i < length; i++) {
            const randomIndex = Math.floor(Math.random() * CHARACTERS.length);
            let char = CHARACTERS.charAt(randomIndex);
            if (randomCase) {
                if (Math.random() < 0.5) {
                    char = char.toUpperCase();
                }
            }
            id += char;
        }
        return id;
    }

    loginToken() {
        const LENGTH = 64;
        return HqId.generate(LENGTH, true);
    }

    avatar() {
        const LENGTH = 5;
        return HqId.generate(LENGTH, true);
    }
}

export default HqId;
