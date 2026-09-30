import { DataTypes, Model } from 'sequelize';
import { eventDb } from '../connections';

class Game extends Model {
    declare gameId: number;
    declare showType: string;
    declare opt: string;
    declare created: Date;
    declare prizeCents: number;
    declare prizePoints: number;
    declare sumPrize: number;
    declare splitCents: number;
    declare splitPoints: number;
}

Game.init({
    gameId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    showType: {
        type: DataTypes.STRING,
        allowNull: false
    },
    opt: {
        type: DataTypes.STRING,
        allowNull: true
    },
    created: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    prizeCents: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
    },
    prizePoints: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
    },
    splitCents: {
        type: DataTypes.TINYINT,
        defaultValue: 1,
        allowNull: false
    },
    splitPoints: {
        type: DataTypes.TINYINT,
        defaultValue: 1,
        allowNull: false
    },
    sumPrize: {
        type: DataTypes.TINYINT,
        defaultValue: 0,
        allowNull: false
    },
}, {
    tableName: 'game',
    sequelize: eventDb,
    freezeTableName: true
});

export default Game;
