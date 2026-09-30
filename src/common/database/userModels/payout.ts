import { DataTypes, Model } from 'sequelize';
import { userDb } from '../connections';

class Payout extends Model {
    declare payoutId: number;
    declare userId: number;
    declare amountCents: number;
    declare payoutEmail: string;
    declare paid: boolean;
    declare client: string | null;
    declare ipAddress: string | null;
    declare created: string;
    declare modified: string;
}

Payout.init({
    payoutId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    amountCents: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    payoutEmail: {
        type: DataTypes.STRING,
        allowNull: false
    },
    paid: {
        type: DataTypes.TINYINT,
        defaultValue: 0,
        allowNull: false
    },
    client: {
        type: DataTypes.STRING
    },
    ipAddress: {
        type: DataTypes.STRING
    },
    created: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    modified: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    }
}, {
    tableName: 'payout',
    sequelize: userDb,
    freezeTableName: true
});

export default Payout;
