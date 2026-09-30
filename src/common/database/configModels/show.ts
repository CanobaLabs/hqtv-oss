import { DataTypes, Model } from 'sequelize';
import { configDb } from '../connections';

class Show extends Model {
    declare showType: string;
    declare gameType: string;
    declare vertical: string;
    declare gameKey: string;
    declare title: string;
    declare summary: string;
    declare accentColor: string;
    declare description: string;
    declare logoUrl: string;
    declare bgImageUrl: string;
    declare bgVideoUrl: string;
    declare defaultOpt: string;
    declare alwaysVisible: boolean;
    declare order: number | null;
    declare hidden: boolean;
}

Show.init({
    showType: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    gameType: {
        type: DataTypes.STRING,
        allowNull: false
    },
    vertical: {
        type: DataTypes.STRING,
        allowNull: false
    },
    gameKey: {
        type: DataTypes.STRING,
        allowNull: false
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    summary: {
        type: DataTypes.STRING,
        allowNull: false
    },
    accentColor: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description: {
        type: DataTypes.STRING,
        allowNull: false
    },
    logoUrl: {
        type: DataTypes.STRING,
        allowNull: false
    },
    bgImageUrl: {
        type: DataTypes.STRING,
        allowNull: false
    },
    bgVideoUrl: {
        type: DataTypes.STRING,
        allowNull: false
    },
    defaultOpt: {
        type: DataTypes.STRING,
        allowNull: true // temp
    },
    alwaysVisible: {
        type: DataTypes.BOOLEAN,
        allowNull: false
    },
    order: {
        type: DataTypes.INTEGER
    },
    hidden: {
        type: DataTypes.BOOLEAN,
        allowNull: true
    },
}, {
    tableName: 'show',
    sequelize: configDb,
    freezeTableName: true
});

export default Show;
