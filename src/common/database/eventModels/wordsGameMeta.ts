import { DataTypes, Model } from 'sequelize';
import { eventDb } from '../connections';

class WordsGameMeta extends Model {
    declare gameId: number;
    declare maxLives: number;
    declare strikes: number;
    declare wheelLetters: string | null;
    declare superWheelEnabled: number;
    declare winnersCap: number;
}

WordsGameMeta.init({
    gameId: {
        type: DataTypes.INTEGER,
        primaryKey: true
    },
    maxLives: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        allowNull: false
    },
    strikes: {
        type: DataTypes.INTEGER,
        defaultValue: 10,
        allowNull: false
    },
    wheelLetters: {
        type: DataTypes.STRING
    },
    superWheelEnabled: {
        type: DataTypes.TINYINT,
        defaultValue: 1
    },
    winnersCap: {
        type: DataTypes.INTEGER
    }
}, {
    tableName: 'wordsGameMeta',
    sequelize: eventDb,
    freezeTableName: true
});

export default WordsGameMeta;
