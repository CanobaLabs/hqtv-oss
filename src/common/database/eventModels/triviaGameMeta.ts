import { DataTypes, Model } from 'sequelize';
import { eventDb } from '../connections';

class TriviaGameMeta extends Model {
    declare gameId: number;
    declare maxLives: number;
    declare maxErasers: number;
    declare winnersCap: number;
}

TriviaGameMeta.init({
    gameId: {
        type: DataTypes.INTEGER,
        primaryKey: true
    },
    maxLives: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        allowNull: false
    },
    maxErasers: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        allowNull: false
    },
    winnersCap: {
        type: DataTypes.INTEGER
    }
}, {
    tableName: 'triviaGameMeta',
    sequelize: eventDb,
    freezeTableName: true
});

export default TriviaGameMeta;
