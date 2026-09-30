import { DataTypes, Model } from 'sequelize';
import { eventDb } from '../connections';

class Production extends Model {
    declare id: number;
    declare createdBy: string;
    declare hosts: string;
    declare writers: string;
    declare producers: string;
    declare complete: number;
    declare questions_status: string;
    declare script_status: string;
    declare game_status: string;
    declare date_at: Date | null;
    declare cancelled: number;
    declare youtube: string | null;
}

Production.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    createdBy: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '423194335476056064'
    },
    hosts: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: ''
    },
    writers: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '649696657348231179'
    },
    producers: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '423194335476056064,261236127581601793'
    },
    complete: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 0
    },
    questions_status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'notStarted'
    },
    script_status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'notStarted'
    },
    game_status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'unaired'
    },
    date_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    cancelled: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 0
    },
    youtube: {
        type: DataTypes.STRING,
        allowNull: true
    },
}, {
    tableName: 'production',
    sequelize: eventDb,
    freezeTableName: true
});

export default Production;
