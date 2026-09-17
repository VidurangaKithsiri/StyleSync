// Only these customer operations may cross the storefront -> ERP API boundary.
export const commerceRoutes=new Map([
 ['/api/auth/session',['GET']], ['/api/auth/register',['POST']],
 ['/api/auth/login',['POST']], ['/api/auth/logout',['POST']], ['/api/auth/password',['POST']],
 ['/api/store/catalog',['GET']], ['/api/store/profile',['GET','POST']],
 ['/api/store/orders',['GET','POST']], ['/api/store/cancel',['POST']]
]);
