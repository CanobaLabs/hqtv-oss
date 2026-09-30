import { DataTypes, Model } from 'sequelize';
import { eventDb } from '../connections';

class Schedule extends Model {
    declare itemId: number;
    declare gameId: number;
    declare rehearsal: number;
    declare startTime: Date | null;
    declare subtitle: string | null;
    declare media: string | null;
    declare visible: number;
    declare autoVisible: number;
}

Schedule.init({
    itemId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    gameId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    rehearsal: {
        type: DataTypes.TINYINT,
        allowNull: false
    },
    startTime: {
        type: DataTypes.DATE
    },
    subtitle: {
        type: DataTypes.STRING
    },
    media: {
        type: DataTypes.STRING
    },
    visible: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 1
    },
    autoVisible: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 0
    }
}, {
    tableName: 'schedule',
    sequelize: eventDb,
    freezeTableName: true
});

export default Schedule;
