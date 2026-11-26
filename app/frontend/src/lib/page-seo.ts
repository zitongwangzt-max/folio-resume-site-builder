import { useEffect } from 'react';

export function usePageSeo(title: string, description: string, noindex = false) {
  useEffect(() => {
    const head = document.head;
    const previous = [...head.querySelectorAll('title, meta[name="description"], meta[name="robots"], link[rel="canonical"]')];
    previous.forEach(node => node.remove());
    const nodes = [
      Object.assign(document.createElement('title'), { textContent: title }),
      Object.assign(document.createElement('meta'), { name: 'description', content: description }),
      Object.assign(document.createElement('meta'), { name: 'robots', content: noindex ? 'noindex,nofollow' : 'index,follow' }),
    ];
    head.append(...nodes);
    return () => {
      nodes.forEach(node => node.remove());
      head.append(...previous);
    };
  }, [title, description, noindex]);
}
