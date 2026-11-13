'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');

test('CampusConnect end-to-end API & security workflow', {timeout:30000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'campusconnect-test-'));
  const port=39000+Math.floor(Math.random()*5000);
  const root=path.resolve(__dirname,'..');
  const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,DB_PATH:path.join(dir,'test.db'),PORT:String(port),HOST:'127.0.0.1',SESSION_SECRET:'local-test-secret-is-very-long-and-randomized-'+String(port)},stdio:'pipe'});
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  t.after(()=>{child.kill();fs.rmSync(dir,{recursive:true,force:true})});
  const base='http://127.0.0.1:'+port;
  async function req(route,method='GET',body,cookie=''){
    const r=await fetch(base+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{'Cookie':cookie}:{})},body:body?JSON.stringify(body):undefined});
    const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data=raw};return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
  }
  let ready=false;for(let i=0;i<80;i++){await delay(100);try{const r=await req('/api/health');if(r.status===200){ready=true;break}}catch{}}
  assert.equal(ready,true,'Server did not boot: '+output);
  let r=await req('/api/auth/me');assert.equal(r.status,401);
  r=await req('/api/auth/login','POST',{email:'admin@campusconnect.local',password:'Admin@123'});assert.equal(r.status,200);let admin=r.cookie;assert.ok(admin.includes('cc_session='));
  r=await req('/api/dashboard','GET',null,admin);assert.equal(r.status,200);assert.equal(typeof r.data.stats.events,'number');
  r=await req('/api/reports','GET',null,admin);assert.equal(r.status,200);assert.equal(r.data.tableCounts.Users,3);
  r=await req('/api/societies','GET',null,admin);assert.equal(r.status,200);const societyId=r.data.societies.find(s=>s.society_name==='AI Society').society_id;
  r=await req('/api/venues','GET',null,admin);assert.equal(r.status,200);const venueId=r.data.venues.find(v=>v.venue_name==='Seminar Hall A').venue_id;
  r=await req('/api/events','POST',{society_id:societyId,title:'Future API Test',event_date:'2027-06-20',start_time:'10:00',end_time:'12:00',capacity:50,status:'Published',description:'Research workshop'},admin);assert.equal(r.status,201,JSON.stringify(r.data));const id=r.data.event.event_id;
  r=await req('/api/planner?event_id='+id,'GET',null,admin);assert.equal(r.status,200);assert.ok(r.data.venues.some(v=>v.venue_id===venueId&&v.available));
  r=await req('/api/bookings','POST',{event_id:id,venue_id:venueId,booking_date:'2027-06-20',start_time:'10:00',end_time:'12:00',booking_status:'Confirmed'},admin);assert.equal(r.status,201);
  r=await req('/api/planner?event_id='+id,'GET',null,admin);assert.equal(r.status,200);assert.ok(r.data.venues.find(v=>v.venue_id===venueId).conflict);
  r=await req('/api/bookings','POST',{event_id:id,venue_id:venueId,booking_date:'2027-06-20',start_time:'10:30',end_time:'11:30',booking_status:'Confirmed'},admin);assert.equal(r.status,400);
  r=await req('/api/calendar?month=2027-06','GET',null,admin);assert.equal(r.status,200);assert.ok(r.data.events.some(x=>x.event_id===id));
  r=await req('/api/auth/signup','POST',{full_name:'Fictional QA Student',email:'student-for-tests@example.test',password:'not-real-password',role:'organizer'});assert.equal(r.status,201);assert.equal(r.data.user.role,'student');const student=r.cookie;
  r=await req('/api/events','POST',{society_id:societyId,title:'Unauthorized',event_date:'2027-06-20',start_time:'13:00',end_time:'14:00',capacity:50},student);assert.equal(r.status,403);
  r=await req('/api/registrations','POST',{event_id:id},student);assert.equal(r.status,201);
  r=await req('/api/registrations','POST',{event_id:id},student);assert.equal(r.status,400);
  r=await req('/api/registrations','GET',null,student);assert.equal(r.status,200);const registration=r.data.registrations.find(x=>x.event_id===id);assert.ok(registration);
  r=await req('/api/registrations/'+registration.registration_id,'PUT',{reg_status:'Cancelled'},student);assert.equal(r.status,200);
  r=await req('/api/registrations','POST',{event_id:id},student);assert.equal(r.status,200);
  r=await req('/api/reports/registrations.csv','GET',null,student);assert.equal(r.status,403);
  r=await req('/api/reports/registrations.csv','GET',null,admin);assert.equal(r.status,200);assert.ok(r.data.includes('Fictional QA Student'));
  r=await req('/','GET');assert.equal(r.status,200);assert.match(r.data,/CampusConnect/);
  r=await req('/app.js','GET');assert.equal(r.status,200);assert.match(r.data,/Smart venue planner/);
  console.log('PASS authentication, role enforcement, six-table data, booking conflicts, planner, calendar, registration & public assets');
});
