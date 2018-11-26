const urlParams = new URLSearchParams(window.location.search);
const myParam = urlParams.get('party_id');

console.log(myParam);