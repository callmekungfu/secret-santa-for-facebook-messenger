const 
    moment = require('moment'),
    dotenv = require('dotenv').config();

const SERVER_URL = process.env.SERVER_URL;

module.exports = {};

module.exports.afterPartyCreation = function (body, party_id) {
    let response = {
        attachment: {
            type: "template",
            payload: {
                template_type: "button",
                text: `Yay! Your ${body.name} party is on its way! Here are the details: \n\nLocation: ${body.location}\nDate: ${moment(body.date).format('MMMM Do YYYY, h:mm a')}\nBudget: $${body.budget}\n\nInvite your friends now! When You are ready, go to My Account > My Parties and click <Start Party>`,
                buttons: [{
                    type: "element_share",
                    share_contents: {
                        attachment: {
                            type: "template",
                            payload: {
                                template_type: 'generic',
                                elements: [{
                                    title: `You are invited to ${body.name} Party!`,
                                    subtitle: `More Details:\n\nLocation: ${body.location}\nDate:${moment(body.date).format('MMMM Do YYYY, h:mm a')}\nBudget:$${body.budget}\n\nJoin Now!`,
                                    image_url: 'https://picsum.photos/400/600',
                                    default_action: {
                                        type: 'web_url',
                                        url: SERVER_URL + `/invitation?party_id=` + party_id,
                                        messenger_extensions: true,
                                        webview_height_ratio: 'tall'
                                    },
                                    buttons: [{
                                        type: "web_url",
                                        title: "Join Now!",
                                        url: SERVER_URL + '/invitation?party_id=' + party_id,
                                        messenger_extensions: true,
                                        webview_height_ratio: 'tall'
                                    }]
                                }]
                            }
                        }
                    }
                }]
            }
        }
    };
    return response;
}

module.exports.partyDetailsPrompt = function (party) {
    // If party already started
    let buttons = [{
        type: 'web_url',
        url: SERVER_URL + '/partydetails?party_id=' + party._id,
        messenger_extensions: true,
        title: "More Details",
        webview_height_ratio: 'tall'
    }]
    if (party.gifting.length === 0) {
        const body = party;
        buttons.push({
            type: "element_share",
            share_contents: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: 'generic',
                        elements: [{
                            title: `You are invited to ${body.name} Party!`,
                            subtitle: `More Details:\n\nLocation: ${body.location}\nDate:${moment(body.date).format('MMMM Do YYYY, h:mm a')}\nBudget:$${body.budget}\n\nJoin Now!`,
                            default_action: {
                                type: 'web_url',
                                url: SERVER_URL + `/invitation?party_id=` + party._id,
                                messenger_extensions: true,
                                webview_height_ratio: 'tall'
                            },
                            buttons: [{
                                type: "web_url",
                                title: "Join Now!",
                                url: SERVER_URL + '/invitation?party_id=' + party._id,
                                messenger_extensions: true,
                                webview_height_ratio: 'tall'
                            }]
                        }]
                    }
                }
            }
        }, {
            type: "web_url",
            title: "Start Party!",
            url: SERVER_URL + '/startparty?party_id=' + party._id,
            messenger_extensions: true,
            webview_height_ratio: 'tall'
        })
    }
    return {
        attachment: {
            type: "template",
            payload: {
                template_type: 'generic',
                elements: [{
                    title: `${party.name}`,
                    image_url: 'https://picsum.photos/400/600',
                    subtitle: `Date: ${moment(party.date).format('MMMM Do YYYY, h:mm a')}\nThere are currently ${party.participants.length-1} friends in the party.`,
                    default_action: {
                        type: 'web_url',
                        url: SERVER_URL + '/partydetails?party_id=' + party._id,
                        messenger_extensions: true,
                        webview_height_ratio: 'tall'
                    },
                    buttons
                }]
            }
        }
    };
}

module.exports.recipientDetailsPrompt = function (user, party) {
    let wishlist = '';
    _.map(user.wishlist, (item) => {
        wishlist += `- ${item.name}\n`
    });
    if (user.wishlist.length === 0) {
        wishlist = 'User Doesn\'t have a wishlist yet'
    }
    return {
        attachment: {
            type: "template",
            payload: {
                template_type: 'generic',
                elements: [{
                    title: `${user.name}`,
                    image_url: user.profile,
                    subtitle: `${party}\n\nWishlist: \n${wishlist}`,
                }]
            }
        }
    };
}