import { Joi } from "express-validation";

module.exports = {
    body: Joi.object({
        userId: Joi.string().required(),
        name: Joi.string().required(),
        email: Joi.string().email().optional(),
        position: Joi.string().optional(),
        category: Joi.string().optional(),
        hired: Joi.string().optional(),
        needsRealName: Joi.boolean().optional()
    }).required()
};
