const orders = document.querySelector("#orders");
const status = document.querySelector("#status");

fetch("data.json", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  })
  .then((items) => {
    status.hidden = true;
    orders.innerHTML = items.map((item) => `<tr><td>${item.id}</td><td>${item.owner}</td><td>${item.amount}</td></tr>`).join("");
  })
  .catch(() => {
    status.hidden = true;
  });
