import { DataTypes, Model } from 'sequelize';
import { userDb } from '../connections';

class LoginToken extends Model {
    declare token: string;
    declare userId: number;
    declare issueDate: Date;
    declare ipAddress: string | null;
    declare xHqDeviceId: string | null;
}

LoginToken.init({
    token: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    issueDate: {
        type: DataTypes.DATE
    },
    ipAddress: {
        type: DataTypes.STRING
    },
    xHqDeviceId: {
        type: DataTypes.STRING
    }
}, {
    modelName: 'loginToken',
    sequelize: userDb,
    freezeTableName: true
});

export default LoginToken;
