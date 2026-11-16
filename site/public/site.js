// Copy buttons: each copies the commands of its block, without the prompt signs.
for (const block of document.querySelectorAll("[data-copy]")) {
  const button = block.querySelector("button")
  const code = block.querySelector("code")
  if (!button || !code) continue
  if (!navigator.clipboard) {
    button.hidden = true
    continue
  }
  button.addEventListener("click", async () => {
    const copy = code.cloneNode(true)
    for (const prompt of copy.querySelectorAll(".prompt")) prompt.remove()
    try {
      await navigator.clipboard.writeText(copy.textContent ?? "")
      button.textContent = "Copied"
    } catch {
      button.textContent = "Select and copy"
    }
    setTimeout(() => {
      button.textContent = "Copy"
    }, 2000)
  })
}
