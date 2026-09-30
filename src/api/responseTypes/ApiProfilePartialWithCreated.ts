import ApiProfilePartial from './ApiProfilePartial';

type ApiProfilePartialWithCreated = ApiProfilePartial & {
    created: string;
}

export default ApiProfilePartialWithCreated;
