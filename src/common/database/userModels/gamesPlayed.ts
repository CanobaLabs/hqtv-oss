import { DataTypes, Model } from 'sequelize';
import { userDb } from '../connections';

class GamePlayed extends Model {
    declare id: number;
    declare gameId: number;
    declare broadcastId: number;
    declare userId: number;
    declare score: number;
    declare joined: Date | null;
    declare client: string | null;
}

GamePlayed.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    gameId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    broadcastId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    score: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    joined: {
        type: DataTypes.DATE
    },
    client: {
        type: DataTypes.STRING
    }
}, {
    tableName: 'gamesPlayed',
    sequelize: userDb,
    freezeTableName: true
});

export default GamePlayed;
