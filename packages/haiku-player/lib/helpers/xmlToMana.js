var parseXmlNonCompliantly = require("./../vendor/xml-parser");
var styleStringToObject = require("./../vendor/to-style").object;
function fixChildren(kids) {
    if (Array.isArray(kids))
        return kids.map(fixNode);
    return fixNode(kids);
}
function fixAttributes(attributes) {
    if (attributes.style) {
        if (typeof attributes.style === "string") {
            attributes.style = styleStringToObject(attributes.style);
        }
    }
    return attributes;
}
function fixNode(obj) {
    if (!obj)
        return obj;
    if (typeof obj === "string")
        return obj;
    var children = obj.children;
    if (obj.content)
        children = [obj.content];
    return {
        elementName: obj.name,
        attributes: fixAttributes(obj.attributes || {}),
        children: fixChildren(children)
    };
}
function xmlToMana(xml) {
    var obj = parseXmlNonCompliantly(xml).root;
    return fixNode(obj);
}
module.exports = xmlToMana;
