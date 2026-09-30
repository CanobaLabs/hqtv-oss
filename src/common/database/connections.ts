import { configDotenv } from 'dotenv';
import { Options, Sequelize } from 'sequelize';
import logger from '../logger';
configDotenv();

const baseOptions: Options = {
    dialect: 'mysql',
    host: process.env.MYSQL_HOST,
    port: +(process.env.MYSQL_PORT || '3306'),
    username: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    logging: false,
    logQueryParameters: true,
    query: { raw: true }, // return record only
    define: { timestamps: false } // don't use updatedAt fields
}

const userDb = new Sequelize({
    ...baseOptions,
    database: 'user'
});

const eventDb = new Sequelize({
    ...baseOptions,
    database: 'event'
});

const featureDb = new Sequelize({
    ...baseOptions,
    database: 'feature'
});

const configDb = new Sequelize({
    ...baseOptions,
    database: 'config'
});

const adminDb = new Sequelize({
    ...baseOptions,
    database: 'admin'
});

[userDb, eventDb, featureDb, configDb, adminDb].forEach(dbInstance => {
    dbInstance.authenticate().catch(err => {
        logger.error('mysql authenticate error', err);
        process.exit(); // critical
    })
});

export { eventDb, userDb, featureDb, configDb, adminDb };

