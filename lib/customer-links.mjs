export async function linkCustomers(client) {
  return client.query(`UPDATE claims c SET customer_record_id=u.id FROM customers u
    WHERE c.customer_record_id IS NULL AND (
      c.customer_id=u.customer_id OR
      (c.customer_id ~ '^[0-9]{14}$' AND left(c.customer_id,6)=$1
       AND ltrim(substring(c.customer_id FROM 7),'0')=u.customer_id))`,
    [process.env.DISTRIBUTOR_CODE || "136928"]);
}
