import { DataTypes, Model } from 'sequelize';
import { userDb } from '../connections';

class EndedStreak extends Model {
    declare streakId: number;
    declare userId: number;
    declare target: number;
    declare actual: number;
    declare startDate: Date;
    declare endDate: Date;
    declare endReason: string;
}

EndedStreak.init({
    streakId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    target: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    actual: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    startDate: {
        type: DataTypes.DATE,
        allowNull: false
    },
    endDate: {
        type: DataTypes.DATE,
        allowNull: false
    },
    endReason: {
        type: DataTypes.ENUM,
        values: ['completed', 'expired', 'absent'],
        allowNull: false
    }
}, {
    tableName: 'endedStreak',
    sequelize: userDb,
    freezeTableName: true
});

export default EndedStreak;
