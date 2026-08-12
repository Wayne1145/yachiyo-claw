package io.github.yachiyoclaw.workspace;

/** Generates bounded browser automation scripts; model input is always JSON-quoted before evaluation. */
final class ControlledBrowserScripts {
    private ControlledBrowserScripts() {}

    static String target(String ref, String selector) {
        if (ref != null && !ref.isBlank()) {
            return "document.querySelector('[data-yachiyo-agent-ref=\"'+CSS.escape(" + quote(ref) + ")+'\"]')";
        }
        return "document.querySelector(" + quote(selector == null ? "" : selector) + ")";
    }

    static String snapshotExpression() {
        return "(() => {" +
            "const clean=v=>String(v||'').replace(/\\s+/g,' ').trim().slice(0,500);" +
            "const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};" +
            "const nodes=[...document.querySelectorAll('a,button,input,textarea,select,[role=button],[role=link],[role=checkbox],[role=tab],[contenteditable=true]')].filter(visible).slice(0,250);" +
            "const elements=nodes.map((e,i)=>{const ref='e'+(i+1);e.setAttribute('data-yachiyo-agent-ref',ref);const r=e.getBoundingClientRect();return {ref,tag:e.tagName.toLowerCase(),role:e.getAttribute('role')||null,name:clean(e.getAttribute('aria-label')||e.innerText||e.value||e.getAttribute('placeholder')||e.getAttribute('title')),type:e.getAttribute('type')||null,disabled:!!e.disabled,checked:typeof e.checked==='boolean'?e.checked:null,selected:typeof e.value==='string'?clean(e.value):null,box:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}}});" +
            "return {url:location.href,title:document.title,text:clean((document.body?.innerText||'').slice(0,50000)),scroll:{x:Math.round(scrollX),y:Math.round(scrollY),height:document.documentElement.scrollHeight,viewportHeight:innerHeight},elements};" +
            "})()";
    }

    static String click(String ref, String selector) {
        return "(() => {const e=" + target(ref, selector) + ";if(!e)return {ok:false,error:'target_not_found'};e.scrollIntoView({block:'center'});e.click();return {ok:true,target:e.getAttribute('data-yachiyo-agent-ref')};})()";
    }

    static String type(String ref, String selector, String text) {
        return "(() => {const e=" + target(ref, selector) + ";if(!e)return {ok:false,error:'target_not_found'};e.scrollIntoView({block:'center'});e.focus();const setter=Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')?.set;if(setter)setter.call(e," + quote(text) + ");else e.value=" + quote(text) + ";e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:null}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true};})()";
    }

    static String scroll(String ref, String direction, int amount) {
        int delta = "up".equals(direction) ? -amount : amount;
        String target = ref == null || ref.isBlank() ? "window" : target(ref, null);
        return "(() => {const e=" + target + ";if(!e)return {ok:false,error:'target_not_found'};e.scrollBy({top:" + delta + ",behavior:'instant'});return {ok:true};})()";
    }

    static String select(String ref, String selector, String value) {
        return "(() => {const e=" + target(ref, selector) + ";if(!(e instanceof HTMLSelectElement))return {ok:false,error:'select_target_invalid'};e.value=" + quote(value) + ";e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true,value:e.value};})()";
    }

    static String waitCondition(String ref, String selector, String value) {
        String target = ref != null && !ref.isBlank() || selector != null && !selector.isBlank()
            ? "Boolean(" + target(ref, selector) + ")"
            : "(document.body?.innerText||'').includes(" + quote(value == null ? "" : value) + ")";
        return "(() => ({ready:" + target + ",url:location.href,title:document.title}))()";
    }

    static String quote(String value) {
        StringBuilder out = new StringBuilder(value.length() + 2).append('"');
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (character < 0x20 || character == '\u2028' || character == '\u2029') out.append(String.format("\\u%04x", (int) character));
                    else out.append(character);
                }
            }
        }
        return out.append('"').toString();
    }
}
