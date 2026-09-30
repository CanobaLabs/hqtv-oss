import { configDotenv } from 'dotenv';
import mongoose from 'mongoose';
import Outline from '../common/database/outline';
import logger from '../common/logger';
configDotenv();

mongoose.connect(process.env.MONGODB as string)
    .then(() => {
        logger.info("Database connection established for MongoDB");
    })
    .catch(err => {
        logger.error(err);
    });
const outline = mongoose.model('outline', Outline);
export { outline };