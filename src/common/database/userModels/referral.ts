import { DataTypes, Model } from 'sequelize';
import { userDb } from '../connections';

class Referral extends Model {
    declare newUserId: number;
    declare referralUserId: number;
}

Referral.init({
    newUserId: {
        type: DataTypes.INTEGER,
        primaryKey: true
    },
    referralUserId: {
        type: DataTypes.INTEGER,
        allowNull: false
    }
}, {
    tableName: 'referral',
    sequelize: userDb,
    freezeTableName: true
});

export default Referral;
