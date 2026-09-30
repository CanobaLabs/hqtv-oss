import { DataTypes, Model } from 'sequelize';
import { userDb } from '../connections';

class CurrentStreak extends Model {
    declare streakId: number;
    declare userId: number;
    declare startDate: Date;
    declare target: number;
    declare current: number;
    declare lastPlayed: Date;
}

CurrentStreak.init({
    streakId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true
    },
    startDate: {
        type: DataTypes.DATE,
        allowNull: false
    },
    target: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    current: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    lastPlayed: {
        type: DataTypes.DATE,
        allowNull: false
    }
}, {
    tableName: 'currentStreak',
    sequelize: userDb,
    freezeTableName: true
});

export default CurrentStreak;
