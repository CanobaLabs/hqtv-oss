import { DataTypes, Model } from 'sequelize';
import { adminDb } from '../connections';

class Audit extends Model {
    declare id: number;
    declare date: string;
    declare to: string;
    declare toType: string;
    declare subTo: string;
    declare subToType: string;
    declare from: string;
    declare fromType: string;
    declare action: string;
    declare description: string;
}

Audit.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    date: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    to: {
        type: DataTypes.STRING,
        allowNull: false
    },
    toType: {
        type: DataTypes.STRING,
        allowNull: false
    },
    subTo: {
        type: DataTypes.STRING,
        allowNull: true
    },
    subToType: {
        type: DataTypes.STRING,
        allowNull: true
    },
    from: {
        type: DataTypes.STRING,
        allowNull: false
    },
    fromType: {
        type: DataTypes.STRING,
        allowNull: false
    },
    action: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT('long'),
        allowNull: false
    }
}, {
    tableName: 'audit',
    sequelize: adminDb,
    freezeTableName: true
});

export default Audit;
