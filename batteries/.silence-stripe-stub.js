
const Module = require('module');
const orig = Module._load;
function FakeStripe(){ return {
  paymentIntents: {
    async create(){
      if (process.env.STRIPE_STUB_THROW === '1') throw new Error('stub: Stripe unreachable');
      const id = 'pi_stub_' + Math.random().toString(36).slice(2,10);
      return { id, client_secret: id + '_secret', status: 'requires_payment_method' };
    },
    async retrieve(id){
      if (process.env.STRIPE_STUB_UNPAID === '1') return { id: id || 'pi_x', status: 'requires_payment_method' };
      return { id: id || 'pi_x', status: 'succeeded', latest_charge: 'py_stub' };
    },
    async cancel(id){ return { id, status: 'canceled' }; }
  }
}; }
Module._load = function(req, parent, isMain){ if (req === 'stripe') return FakeStripe; return orig.apply(this, arguments); };
