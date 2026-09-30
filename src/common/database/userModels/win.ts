import { DataTypes, Model } from 'sequelize';
import { userDb } from '../connections';

class Win extends Model {
    declare winId: number;
    declare winDate: string;
    declare updatedDate: string;
    declare userId: number;
    declare gameId: number;
    declare showType: string;
    declare prizeCents: number;
    declare prizePoints: number;
    declare frozen: boolean;
    declare checkpointId: string | null;
    declare payoutId: number | null;
}

Win.init({
    winId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    winDate: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    updatedDate: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    gameId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    showType: {
        type: DataTypes.STRING,
        allowNull: false
    },
    prizeCents: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    prizePoints: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    frozen: {
        type: DataTypes.TINYINT,
        defaultValue: 1,
        allowNull: false
    },
    checkpointId: {
        type: DataTypes.STRING
    },
    payoutId: {
        type: DataTypes.INTEGER
    }
}, {
    tableName: 'win',
    sequelize: userDb,
    freezeTableName: true
});

export default Win;
