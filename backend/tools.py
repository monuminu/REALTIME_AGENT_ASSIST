import json
import random
import pandas as pd
from datetime import datetime, timedelta
import uuid
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
import os

import logging
logging.basicConfig(  
    level=logging.INFO,  
    format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",  
    datefmt="%Y-%m-%d %H:%M:%S",  
)  
logger = logging.getLogger(__name__)  
 
search_client = SearchClient(
    endpoint=os.environ["AZURE_SEARCH_ENDPOINT"],
    index_name=os.environ["INDEX_NAME"],
    credential=AzureKeyCredential(os.environ["AZURE_SEARCH_KEY"]) 
)

async def fetch_relevant_documents_handler(query, **args):
    search_results = search_client.search(
        search_text=query,
        top=5,
        select="content"
    )
    sources_formatted = "\n".join([f'{document["content"]}' for document in search_results])
    return sources_formatted

async def raise_ticket_handler(customer_id, issue, out_queue):
    return f"Ticket raised for customer {customer_id}. Issue: {issue}. A representative will contact you shortly."
  

async def track_refund_handler(phone_number, out_queue):
    refund_status_df = pd.read_excel('myntra_dummy_data.xlsx', sheet_name='Sheet1')
    refund_status_df["Phone number"] = refund_status_df["Phone number"].astype(str)
    refund_status_df = refund_status_df[refund_status_df['Phone number'] == phone_number]
    if refund_status_df.empty:
        return f"No refund found for phone number {phone_number}"
    return refund_status_df.to_markdown(index=False)
  
async def cancel_order_handler(phone_number, reason, out_queue):  
    status = "Cancelled"
    # Generate random cancellation details
    cancellation_date = datetime.now()
    refund_amount = round(random.uniform(10, 500), 2)
    return f"Order for phone number {phone_number} has been cancelled. Reason: {reason}. A confirmation email has been sent."  
  
async def schedule_callback_handler(customer_id, callback_time, out_queue):  
    return f"Callback scheduled for customer {customer_id} at {callback_time}. A representative will contact you then."
  
async def check_order_status_handler(phone_number, out_queue = None):
    logger.info("Checking order status")
    order_status_df = pd.read_excel('myntra_dummy_data.xlsx', sheet_name='Sheet2')  
    order_status_df["Phone number"] = order_status_df["Phone number"].astype(str)
    logger.info(f"phone_number: {phone_number}")
    order_status_df = order_status_df[order_status_df['Phone number'] == phone_number]
    if order_status_df.empty:
        return f"No orders found for phone number {phone_number}"
    return order_status_df.to_markdown(index=False)
    

async def process_return_handler(phone_number, reason, out_queue):
    return f"Return initiated for phone number {phone_number}. Reason: {reason}. Please expect a refund within 5-7 business days."

async def get_product_info_handler(customer_id, product_id, out_queue):
    products = {
        "P001": {"name": "Wireless Earbuds", "price": 79.99, "stock": 50},
        "P002": {"name": "Smart Watch", "price": 199.99, "stock": 30},
        "P003": {"name": "Laptop Backpack", "price": 49.99, "stock": 100}
    }
    product_info = products.get(product_id, "Product not found")
    return f"Product information for customer {customer_id}: {json.dumps(product_info)}"

async def update_account_info_handler(customer_id, field, value, out_queue):
    return f"Account information updated for customer {customer_id}. {field.capitalize()} changed to: {value}"

async def get_customer_info_handler(customer_id, out_queue):  
    # Simulated customer data (using placeholder information)  
    customers = {  
        "C001": {"membership_level": "Gold", "account_status": "Active"},  
        "C002": {"membership_level": "Silver", "account_status": "Pending"},  
        "C003": {"membership_level": "Bronze", "account_status": "Inactive"},  
    }  
    customer_info = customers.get(customer_id, out_queue)  
    if customer_info:  
        # Return customer information in JSON format  
        return json.dumps({  
            "customer_id": customer_id,  
            "membership_level": customer_info["membership_level"],  
            "account_status": customer_info["account_status"]  
        })  
    else:  
        return f"Customer with ID {customer_id} not found."  

# Handler Functions  
async def track_shipment_handler(customer_id, tracking_number, out_queue):  
    statuses = ["In Transit", "Out for Delivery", "Delivered", "Delayed"]  
    status = random.choice(statuses)  
    return f"Shipment for customer {customer_id} with tracking number {tracking_number} is currently: {status}."  

tools_mapping = {"get_all_order_for_customer" : check_order_status_handler,
                 "get_all_refund_details_for_customer" : track_refund_handler,
                 "raise_ticket" : raise_ticket_handler,
                  "cancel_order" : cancel_order_handler,
                  "schedule_callback" : schedule_callback_handler, 
                  "process_return" : process_return_handler,
                  "get_product_info" : get_product_info_handler,
                  "update_account_info" : update_account_info_handler,
                  "get_customer_info" : get_customer_info_handler,
                  "track_shipment" : track_shipment_handler
                }