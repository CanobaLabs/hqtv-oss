import { Joi } from "express-validation";

module.exports = {
    body: Joi.object({
        gameType: Joi.string().optional(),
        vertical: Joi.string().optional(),
        gameKey: Joi.string().optional(),
        title: Joi.string().optional(),
        summary: Joi.string().optional(),
        accentColor: Joi.string().optional(),
        description: Joi.string().optional(),
        logoUrl: Joi.string().optional(),
        bgImageUrl: Joi.string().optional(),
        bgVideoUrl: Joi.string().optional(),
        defaultOpt: Joi.string().optional(),
        alwaysVisible: Joi.boolean(),
        order: Joi.number(),
        hidden: Joi.boolean()
    })
};
