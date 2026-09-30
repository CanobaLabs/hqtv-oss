import { DataTypes, Model } from 'sequelize';
import { userDb } from '../connections';

class Account extends Model {
    declare id: number;
    declare name: string;
    declare avatarUrl: string | null;
    declare created: Date;
    declare admin: number;
    declare tester: number;
    declare booster: number;
    declare chatBan: number;
    declare gameBan: number;
    declare appBan: number;
    declare purged: number;
}

Account.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    avatarUrl: {
        type: DataTypes.STRING
    },
    created: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    admin: {
        type: DataTypes.TINYINT,
        defaultValue: 0,
        allowNull: false
    },
    tester: {
        type: DataTypes.TINYINT,
        defaultValue: 0,
        allowNull: false
    },
    booster: {
        type: DataTypes.TINYINT,
        defaultValue: 0,
        allowNull: false
    },
    chatBan: {
        type: DataTypes.TINYINT,
        defaultValue: 0,
        allowNull: false
    },
    gameBan: {
        type: DataTypes.TINYINT,
        defaultValue: 0,
        allowNull: false
    },
    appBan: {
        type: DataTypes.TINYINT,
        defaultValue: 0,
        allowNull: false
    },
    purged: {
        type: DataTypes.TINYINT,
        defaultValue: 0,
        allowNull: false
    },
}, {
    tableName: 'account',
    sequelize: userDb,
    freezeTableName: true
});

export default Account;
