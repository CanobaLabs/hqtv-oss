import { Joi } from "express-validation";

module.exports = {
    body: Joi.object({
        showType: Joi.string().required()
    }).required()
};
