import { DataTypes, Model } from 'sequelize';
import { configDb } from '../connections';

class KeepPlayingConfig extends Model {
    declare versionId: number;
    declare enabled: number;
    declare baseCoins: number;
    declare coinsPerRightAnswer: number;
    declare eraserChance: number;
    declare lifeChance: number;
    declare maxErasers: number;
    declare maxLives: number;
    declare consecutiveChanceMulti: number;
}

KeepPlayingConfig.init({
    versionId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    enabled: {
        type: DataTypes.TINYINT
    },
    baseCoins: {
        type: DataTypes.INTEGER
    },
    coinsPerRightAnswer: {
        type: DataTypes.INTEGER
    },
    eraserChance: {
        type: DataTypes.FLOAT
    },
    lifeChance: {
        type: DataTypes.FLOAT
    },
    maxErasers: {
        type: DataTypes.INTEGER
    },
    maxLives: {
        type: DataTypes.INTEGER
    },
    consecutiveChanceMulti: {
        type: DataTypes.FLOAT
    }
}, {
    tableName: 'keepPlayingConfig',
    sequelize: configDb,
    freezeTableName: true
});

export default KeepPlayingConfig;
