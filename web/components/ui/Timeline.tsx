'use client';
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import styles from './timeline.module.css';

export interface TimelineEvent { id:string; at:string|number; actor?:string; title:string; meta?:string; detail?:ReactNode; avatar?:string; icon?:ReactNode; tone?:'neutral'|'success'|'danger' }
export interface TimelineProps { events:TimelineEvent[]; now:number; label:string; timeZone?:string; locale?:string; maxHeight?:number|string; scrollToNew?:boolean; defaultExpanded?:string[]; headingLevel?:2|3|4|5|6; className?:string }

export function Timeline({ events, now, label, timeZone='UTC', locale='en-US', maxHeight, defaultExpanded=[], headingLevel=3, className }:TimelineProps) {
  const rootId=useId(); const reduced=useReducedMotion(); const [expanded,setExpanded]=useState(()=>new Set(defaultExpanded));
  const groups=useMemo(()=>{
    const key=(time:number)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
    const today=key(now), yesterday=key(now-86400000); const map=new Map<string,any[]>();
    [...events].map(e=>({...e,time:new Date(e.at).getTime()})).filter(e=>Number.isFinite(e.time)).sort((a,b)=>b.time-a.time).forEach(e=>{const day=key(e.time);map.set(day,[...(map.get(day)||[]),e]);});
    const fmt=new Intl.DateTimeFormat(locale,{weekday:'long',month:'long',day:'numeric',timeZone});
    return [...map].map(([day,rows])=>({day,rows,label:day===today?'Today':day===yesterday?'Yesterday':fmt.format(new Date(rows[0].time))}));
  },[events,now,timeZone,locale]);
  const clock=new Intl.DateTimeFormat(locale,{hour:'numeric',minute:'2-digit',timeZone});
  const full=new Intl.DateTimeFormat(locale,{dateStyle:'full',timeStyle:'short',timeZone});
  function keys(e:KeyboardEvent<HTMLDivElement>){if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;const all=[...e.currentTarget.querySelectorAll<HTMLElement>('[data-timeline-trigger]')],i=all.indexOf(document.activeElement as HTMLElement);if(i<0)return;e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?all.length-1:Math.max(0,Math.min(all.length-1,i+(e.key==='ArrowDown'?1:-1)));all[n]?.focus();}
  return <div className={[styles.root,className].filter(Boolean).join(' ')} role="region" aria-label={label}>
    <div className={styles.scroller} style={maxHeight?{maxHeight:typeof maxHeight==='number'?`${maxHeight}px`:maxHeight}:undefined} onKeyDown={keys}>
      {groups.map(group=><section key={group.day} className={styles.group} aria-labelledby={`${rootId}-${group.day}`}>
        <div id={`${rootId}-${group.day}`} role="heading" aria-level={headingLevel} className={styles.day}><span>{group.label}</span><span>{group.rows.length} {group.rows.length===1?'update':'updates'}</span></div>
        <ol className={styles.list}>{group.rows.map((row,index)=>{const open=expanded.has(row.id);const relative=Math.max(0,Math.floor((now-row.time)/60000));const short=relative<1?'Now':relative<60?`${relative}m`:clock.format(new Date(row.time));return <motion.li key={row.id} className={styles.item} initial={reduced?false:{opacity:0,y:5}} animate={{opacity:1,y:0}}>
          <span className={styles.rail}><span className={styles.marker} data-tone={row.avatar?undefined:row.tone||'neutral'}>{row.avatar?<img src={row.avatar} alt=""/>:row.icon}</span>{index<group.rows.length-1&&<span className={styles.line}/>}</span>
          <div className={styles.content}>{row.detail?<button type="button" data-timeline-trigger className={styles.trigger} aria-expanded={open} onClick={()=>setExpanded(s=>{const n=new Set(s);n.has(row.id)?n.delete(row.id):n.add(row.id);return n;})}><EventText row={row}/><time dateTime={new Date(row.time).toISOString()} title={full.format(new Date(row.time))}>{short}</time><motion.span animate={{rotate:open?180:0}}><ChevronDown size={15}/></motion.span></button>:<div className={styles.trigger}><EventText row={row}/><time>{short}</time></div>}
          <AnimatePresence initial={false}>{open&&row.detail&&<motion.div className={styles.detail} initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}}>{row.detail}</motion.div>}</AnimatePresence></div>
        </motion.li>})}</ol>
      </section>)}
    </div>
  </div>;
}
function EventText({row}:{row:TimelineEvent}){return <span className={styles.text}><span><strong>{row.actor}</strong>{row.actor?' ':''}{row.title}</span>{row.meta&&<small>{row.meta}</small>}</span>}
export default Timeline;
