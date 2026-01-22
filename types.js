/**
 * @typedef {Object} PhotoDimensions
 * @property {number} width - The width of the photo in pixels
 * @property {number} height - The height of the photo in pixels
 */

/**
 * @typedef {Object} Photo
 * @property {string} id - Unique identifier for the photo
 * @property {string} filename - The filename of the photo
 * @property {string} path - The absolute file path to the photo
 * @property {number} size - The file size in bytes
 * @property {number} modified - The last modified timestamp in milliseconds
 * @property {PhotoDimensions} dimensions - The dimensions of the photo
 */

export {};
