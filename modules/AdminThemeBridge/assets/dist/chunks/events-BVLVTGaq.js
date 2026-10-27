function e(n,t="change"){n&&n.dispatchEvent(new Event(t,{bubbles:!0}))}function a(n,t){!n||n.value===t||(n.value=t,e(n))}export{e as c,a as s};
