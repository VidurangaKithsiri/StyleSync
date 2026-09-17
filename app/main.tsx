import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Workspace from './workspace';
import Auth from './auth';
import Storefront from './storefront';
import './globals.css';
import './storefront.css';
function App(){const pathname=window.location.pathname;const isErp=pathname.startsWith('/erp');const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[error,setError]=useState('');useEffect(()=>{if(!isErp||pathname!=='/erp'){setStatus('ready');return}fetch('/api/auth/session?kind=erp').then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);if(!d.user){window.location.replace('/erp/login');return}setStatus('ready')}).catch(e=>{setError(e.message);setStatus('error')})},[]);if(status==='error')return <main className="auth-landing"><section><h1>Unable to open ERP</h1><p>{error}</p><a className="auth-secondary" href="/erp/login">Sign in again</a></section></main>;if(status==='loading')return <main className="auth-landing"><p>Opening ShopLink…</p></main>;if(pathname==='/erp/login'||pathname==='/erp/signup')return <Auth kind="erp" initialSignup={pathname.endsWith('signup')}/>;if(isErp)return <Workspace/>;if(pathname==='/login'||pathname==='/signup')return <Auth kind="customer" initialSignup={pathname==='/signup'}/>;return <Storefront/>}
createRoot(document.getElementById('root')!).render(<App/>);
