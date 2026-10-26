// The backend exports the validation factory. Browsers need its standard instance.
// Both use the unchanged shared implementation and canonical date/error contracts.
import factory from '../../../shared/validation.js';
const validation = typeof factory === 'function' ? factory.createDefault() : factory;
export default validation;
