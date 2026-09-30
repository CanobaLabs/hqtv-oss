import { S3Client } from '@aws-sdk/client-s3';
import { configDotenv } from 'dotenv';

configDotenv();

const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT!,
    region: 'us-east-1',
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!
    }
});

export default s3;
