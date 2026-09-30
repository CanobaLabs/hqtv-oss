class HqError {
    statusCode: () => number;
    constructor(public error: string, public errorCode: number, statusCode: number = 200) {
        this.error = error;
        this.errorCode = errorCode;
        this.statusCode = () => statusCode; // do not appear in response
    }
}

export default HqError;
